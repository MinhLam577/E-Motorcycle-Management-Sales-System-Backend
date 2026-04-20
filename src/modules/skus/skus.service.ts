import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateSkusDto } from './dto/create-skus.dto';
import { UpdateSkusDto } from './dto/update-skus.dto';
import { In, Not, Repository } from 'typeorm';
import { Skus } from './entities/skus.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Import } from '../import/entities/import.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { DetailImport } from '../detail_import/entities/detail_import.entity';
import { Products } from '../products/entities/product.entity';
import { OptionValue } from '../option_value/entities/option_value.entity';
import { Option } from '../option/entities/option.entity';
import { isUUID } from 'class-validator';
import QuerySkusDto from './dto/query-skus.dto';
import dayjs from 'dayjs';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import GetSkusByOptionValuesIdsDto from './dto/getSkusByOptionValuesIds.dto';
import GetByIdsDto from './dto/getByIds.dto';
import { UserValidationType } from 'src/auth/strategy/jwt.strategy';

@Injectable()
export class SkusService {
  constructor(
    @InjectRepository(Skus)
    private readonly Skureposity: Repository<Skus>,

    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // Lấy danh sách tất cả SKU
  async findAll(query: QuerySkusDto) {
    const {
      brand_id,
      product_id,
      warehouse_id,
      search,
      current = 1,
      pageSize = 10,
      sortOrder,
    } = query;

    try {
      const skip = (current - 1) * pageSize;
      const take = pageSize;
      const queryBuilder = this.Skureposity.createQueryBuilder('skus')
        .leftJoinAndSelect('skus.optionValue', 'optionValue')
        .leftJoinAndSelect('optionValue.option', 'option')
        .leftJoinAndSelect('skus.detail_import', 'detail_import')
        .leftJoinAndSelect('detail_import.warehouse', 'warehouse')
        .leftJoinAndSelect('skus.product', 'products');

      if (brand_id) {
        queryBuilder.andWhere('products.brand_id = :brand_id', { brand_id });
      }

      if (product_id) {
        queryBuilder.andWhere('products.id = :product_id', { product_id });
      }

      if (warehouse_id) {
        queryBuilder.andWhere('warehouse.id = :warehouse_id', { warehouse_id });
      }

      if (search) {
        if (isUUID(search)) {
          queryBuilder.andWhere('skus.id = :id', { id: search });
        }
        queryBuilder.andWhere(
          '(skus.masku ILIKE :search OR skus.barcode ILIKE :search or skus.name ILIKE :search)',
          { search: `%${search}%` },
        );
      }

      const [data, total] = await queryBuilder
        .orderBy('skus.updatedAt', sortOrder === 'asc' ? 'ASC' : 'DESC')
        .skip(skip)
        .take(take)
        .select([
          'skus',
          'optionValue',
          'option',
          'detail_import',
          'warehouse',
          'products.title',
          'products.id',
          'products.images',
        ])
        .getManyAndCount();
      const totalPage = Math.ceil(total / pageSize);
      return {
        status: 200,
        message: 'Lấy danh sách SKU thành công',
        data: {
          data,
          meta: {
            current,
            pageSize,
            total,
            totalPage,
          },
        },
      };
    } catch (e) {
      throw e;
    }
  }

  async findDetailImportBySkuId(id: string) {
    try {
      const sku = await this.Skureposity.findOne({
        where: { id },
        relations: ['detail_import', 'detail_import.warehouse'],
      });

      if (!sku) {
        throw new NotFoundException(`SKU with ID ${id} not found`);
      }

      // Lấy danh sách chi tiết nhập kho từ SKU
      const detailImportList = sku.detail_import.map((detail) => ({
        ...detail,
      }));

      return detailImportList;
    } catch (e) {
      throw e;
    }
  }

  async findDetailImportBySkuIds(idArray: string[]) {
    try {
      idArray.forEach((id) => {
        if (!isUUID(id)) {
          throw new BadRequestException(
            `ID ${id} không hợp lệ, id phải là UUID`,
          );
        }
      });
      const sku = await this.Skureposity.find({
        where: { id: In(idArray) },
        relations: ['detail_import', 'detail_import.warehouse', 'product'],
      });

      const notFoundSku = idArray.filter(
        (id) => !sku.some((item) => item.id === id),
      );

      if (notFoundSku.length > 0) {
        throw new NotFoundException(
          `SKU with ID ${notFoundSku.join(', ')} not found`,
        );
      }
      const result = sku.map((item) => {
        return {
          id: item.id,
          detail_import: item.detail_import.map((detail) => ({ ...detail })),
        };
      });

      return result;
    } catch (e) {
      throw e;
    }
  }

  // Ví dụ thêm một hàm tìm kiếm SKU theo ID
  async findOne(id: string): Promise<Skus> {
    return await this.Skureposity.findOne({
      where: { id },
      relations: ['optionValue', 'detail_import'], // Load các quan hệ liên quan
    });
  }

  // Xóa SKU
  async remove(id: string) {
    try {
      return await this.Skureposity.manager.transaction(async (manager) => {
        const sku = await manager.findOne(Skus, {
          where: { id },
          relations: [
            'detail_import',
            'detail_import.import',
            'cart_item',
            'orderDetails',
            'product',
          ],
        });
        if (!sku) {
          throw new NotFoundException(`SKU with ID ${id} not found`);
        }

        const detailImports = sku.detail_import || [];
        const totalSold = detailImports.reduce(
          (total, detail) => total + detail.quantity_sold,
          0,
        );
        if (totalSold > 0) {
          throw new BadRequestException(
            `Không thể xóa tổ hợp "${sku.name}" vì đã được bán`,
          );
        }
        // Xóa các bản ghi liên quan
        if (sku.cart_item && sku.cart_item?.length > 0) {
          throw new BadRequestException(
            `Không thể xóa SKU "${sku.name}" vì nó đang được sử dụng trong giỏ hàng`,
          );
        }
        if (sku.orderDetails && sku.orderDetails?.length > 0) {
          throw new BadRequestException(
            `Không thể xóa SKU "${sku.name}" vì nó đã được đặt hàng`,
          );
        }

        await manager.delete(Skus, { id });
        // Thu thập danh sách Import IDs
        const importIds = new Set<string>(
          detailImports
            .filter((detail) => detail.import)
            .map((detail) => detail.import.id),
        );
        // Kiểm tra và xóa Import nếu không còn DetailImport
        if (importIds.size > 0) {
          const imports = await manager.find(Import, {
            where: { id: In([...importIds]) },
            relations: ['detail_imports'],
          });
          for (const importEntity of imports) {
            if (importEntity.detail_imports.length === 0) {
              await manager.delete(Import, importEntity.id);
            }
          }
        }

        const product = await manager.findOne(Products, {
          where: { id: sku.product.id },
          relations: ['skus'],
        });

        if (product && product.skus.length === 0) {
          await manager.delete(Products, product.id);
        }

        return {
          status: 200,
          message: 'Xóa SKU thành công',
        };
      });
    } catch (e) {
      throw e;
    }
  }

  // Cập nhật SKU
  async update(id: string, updateSkusDto: UpdateSkusDto) {
    try {
      return await this.Skureposity.manager.transaction(async (manager) => {
        const { product_id, masku, barcode, image, ...restSkusData } =
          updateSkusDto;
        const product = await manager.findOne(Products, {
          where: { id: product_id },
        });
        if (!product) {
          throw new NotFoundException(
            `Sản phẩm với ID ${product_id} không tồn tại`,
          );
        }

        const existingSku = await manager.findOne(Skus, {
          where: { id },
          relations: [
            'product',
            'optionValue',
            'optionValue.option',
            'detail_import',
          ],
        });

        if (!existingSku) {
          throw new NotFoundException(`SKU với ID ${id} không tồn tại`);
        }

        if (masku) {
          const existingMasku = await manager.findOne(Skus, {
            where: { masku, id: Not(id) },
          });
          if (existingMasku) {
            throw new ConflictException(`SKU "${masku}" đã tồn tại`);
          }
        }

        if (barcode) {
          const existingBarcode = await manager.findOne(Skus, {
            where: { barcode, id: Not(id) },
          });

          if (existingBarcode) {
            throw new ConflictException(`barcode "${barcode}" đã tồn tại`);
          }
        }

        const { variant_combinations, ...restSkusUpdateData } = restSkusData;
        let skus_name = '';
        const updatedSku = manager.merge(Skus, existingSku, {
          ...restSkusUpdateData,
          masku: masku || '',
          barcode: barcode || '',
          image: image || '',
        });
        if (!updatedSku?.name) {
          const optionValues = existingSku.optionValue.map((ov) => ov.value);
          skus_name =
            optionValues.reduce((acc, cur) => {
              const option = cur || '';
              return acc ? `${acc} / ${option}` : option;
            }, '') || '';
        }

        if (variant_combinations?.length) {
          const validVariants = variant_combinations.filter(
            (variant) => variant !== null && variant !== undefined,
          );
          const optionIds = validVariants.map((variant) => variant.option_id);
          const options = await manager.find(Option, {
            where: { id: In(optionIds) },
          });
          const optionsMap = new Map(options.map((o) => [o.id, o]));
          const notFoundOptions = optionIds.filter((id) => !optionsMap.has(id));
          if (notFoundOptions.length > 0) {
            throw new NotFoundException(
              `Không tìm thấy Option với ID: ${notFoundOptions.join(', ')}`,
            );
          }
          const existingOptionValues = existingSku.optionValue;
          const existingOptionValuesMap = new Map(
            existingOptionValues.map((o) => [o.option.id, o]),
          );
          const updatedOptionValues = variant_combinations.map((variant) => {
            const existingOptionValue = existingOptionValuesMap.get(
              variant.option_id,
            );
            if (!existingOptionValue) {
              throw new NotFoundException(
                `Không tìm thấy thuộc tính ${optionsMap.get(variant.option_id)?.name} trong biến thể với ID ${id}`,
              );
            }
            return manager.merge(OptionValue, existingOptionValue, {
              value: variant.value,
            });
          });

          await manager.save(updatedOptionValues);
          const optionValuesNames = updatedOptionValues.map((ov) => ov.value);
          skus_name = optionValuesNames.reduce((acc, cur) => {
            const option = cur || '';
            return acc ? `${acc} / ${option}` : option;
          }, '');
        }

        if (skus_name) {
          updatedSku.name = skus_name;
        }

        const savedSku = await manager.save(updatedSku);

        return {
          status: 200,
          message: 'Cập nhật biến thể thành công',
          data: savedSku,
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async create(createSkusDto: CreateSkusDto) {
    try {
      return await this.Skureposity.manager.transaction(async (manager) => {
        const { product_id, masku, barcode, ...restData } = createSkusDto;
        const product = await manager.findOne(Products, {
          where: { id: product_id },
        });

        if (!product) {
          throw new NotFoundException(
            `Sản phẩm với ID ${product_id} không tồn tại`,
          );
        }

        // Kiểm tra masku có bị trùng không
        if (masku) {
          const existingSku = await manager.findOne(Skus, {
            where: { masku },
          });

          if (existingSku) {
            throw new ConflictException(`masku "${masku}" đã tồn tại`);
          }
        }

        // Kiểm tra barcode có bị trùng không
        if (barcode) {
          const existingBarcode = await manager.findOne(Skus, {
            where: { barcode },
          });

          if (existingBarcode) {
            throw new ConflictException(`barcode "${barcode}" đã tồn tại`);
          }
        }

        const { detail_import, variant_combinations, ...restSkusData } =
          restData;
        // Tạo SKU mới
        const newSku = manager.create(Skus, {
          ...restSkusData,
          masku: masku || '',
          barcode: barcode || '',
          image: restSkusData.image || '',
          product,
        });
        const skus_name =
          restData.variant_combinations.reduce((acc, cur) => {
            const option = cur.value || '';
            return acc ? `${acc} / ${option}` : option;
          }, '') || 'Mặc định';
        if (skus_name) {
          newSku.name = skus_name;
        }

        const savedSku = await manager.save(newSku);

        // Tạo optionValue nếu có
        if (restData.variant_combinations?.length) {
          const validVariants = restData.variant_combinations.filter(
            (variant) => variant !== null && variant !== undefined,
          );
          const optionIds = validVariants.map((variant) => variant.option_id);
          const options = await manager.find(Option, {
            where: { id: In(optionIds) },
          });
          const optionsMap = new Map(options.map((o) => [o.id, o]));
          const notFoundOptions = optionIds.filter((id) => !optionsMap.has(id));
          if (notFoundOptions.length > 0) {
            throw new NotFoundException(
              `Không tìm thấy Option với ID: ${notFoundOptions.join(', ')}`,
            );
          }
          if (validVariants.length > 0) {
            const OptionValues = validVariants.map((variant) =>
              manager.create(OptionValue, {
                option: optionsMap.get(variant.option_id),
                value: variant.value,
                skus: savedSku,
              }),
            );
            await manager.save(OptionValues);
          }
        }

        // Tạo DetailImport
        const warehouseIds = restData.detail_import.map((i) => i.warehouse_id);
        const warehouses = await manager.find(Warehouse, {
          where: { id: In(warehouseIds) },
        });
        const warehousesMap = new Map(warehouses.map((w) => [w.id, w]));
        const notFoundWarehouses = warehouseIds.filter(
          (id) => !warehousesMap.has(id),
        );

        if (notFoundWarehouses.length > 0) {
          throw new NotFoundException(
            `Không tìm thấy Warehouse với ID: ${notFoundWarehouses.join(', ')}`,
          );
        }

        // Tạo bản ghi nhập hàng
        const createImport = manager.create(Import, {
          note: `Nhập biến thể ${skus_name ? '- ' + skus_name : ''} cho sản phẩm ${product.title}`,
          // user,
        });
        const saveImport = await manager.save(createImport);

        // Tạo DetailImport cho từng kho
        const newDetailImports =
          restData.detail_import.map((detail, index) => {
            const warehouse = warehousesMap.get(detail.warehouse_id);
            const lotName =
              detail.lot_name ||
              `${product.title} ${skus_name ? '- ' + skus_name : ''} - ${warehouse.name} - ${dayjs(Date.now()).format('DD/MM/YYYY HH:mm:ss')}`;
            return manager.create(DetailImport, {
              warehouse,
              quantity_import: detail.quantity_import,
              price_import: detail.price_import,
              quantity_remaining: detail.quantity_import,
              quantity_sold: 0,
              skus: savedSku,
              import: saveImport,
              lot_name: lotName,
            });
          }) || [];
        await manager.save(newDetailImports);

        return {
          status: 200,
          message: 'Tạo SKU thành công',
          data: {
            ...savedSku,
            detail_import: newDetailImports,
            product,
          },
        };
      });
    } catch (e) {
      throw e;
    }
  }

  // Hàm này sẽ lấy ra tất cả các kết hợp của ID option value từ optionValueDto
  private getAllOptionValueCombinations(
    optionValuesDto: GetSkusByOptionValuesIdsDto['optionValues'],
  ): string[][] {
    const combinations: string[][] = [];
    const optionValueIds = optionValuesDto.map((ov) => ov.option_value_ids);
    const optionValueIdsLength = optionValueIds.length;

    const generateCombinations = (
      currentCombination: string[],
      index: number,
    ) => {
      if (index === optionValueIdsLength) {
        combinations.push(currentCombination);
        return;
      }
      for (const id of optionValueIds[index]) {
        generateCombinations([...currentCombination, id], index + 1);
      }
    };

    generateCombinations([], 0);
    return combinations;
  }

  async getSkusByOptionValueAlreadyLoginIds(
    body: GetSkusByOptionValuesIdsDto,
    user: UserValidationType,
  ) {
    try {
      if (!user || !user.id) {
        throw new BadRequestException(
          'User không hợp lệ hoặc không tồn tại hoặc chưa đăng nhập',
        );
      }
      const { optionValues } = body;
      const allIdsCombination =
        this.getAllOptionValueCombinations(optionValues);

      if (allIdsCombination.length === 0) {
        throw new BadRequestException(
          'Không có ID option value nào được cung cấp',
        );
      }
      const resultData = [];
      for (const ids of allIdsCombination) {
        const subquery = this.Skureposity.createQueryBuilder('sku')
          .innerJoin('sku.optionValue', 'optionValue')
          .where('optionValue.id IN (:...ids)', { ids })
          .groupBy('sku.id')
          .having('COUNT(DISTINCT optionValue.id) = :count', {
            count: ids.length,
          })
          .select('sku.id');

        const queryBuilder = this.Skureposity.createQueryBuilder('sku')
          .leftJoin('sku.detail_import', 'detail_import')
          .leftJoin('sku.cart_item', 'cart_item')
          .leftJoin('cart_item.cart', 'cart')
          .leftJoin('cart.customer', 'customer')
          .where(`sku.id IN (${subquery.getQuery()})`)
          .andWhere('customer.id = :userId', { userId: user.id })
          .setParameters(subquery.getParameters())
          .select([
            'sku.id',
            'sku.masku',
            'sku.barcode',
            'sku.name',
            'sku.price_sold',
            'sku.price_compare',
            'sku.image',
            'sku.status',
            'detail_import.quantity_remaining',
            'detail_import.quantity_sold',
            'cart_item.id',
            'cart_item.quantity',
          ]);

        const skus = await queryBuilder.getOne();
        if (!skus) {
          continue;
        }
        const detailImports = skus?.detail_import || [];
        const totalRemaining =
          detailImports.reduce(
            (total, detail) => total + detail.quantity_remaining,
            0,
          ) || 0;
        const totalSold =
          detailImports.reduce(
            (total, detail) => total + detail.quantity_sold,
            0,
          ) || 0;

        const { detail_import, ...restSkus } = skus;
        resultData.push({
          quantity_remaining: totalRemaining,
          quantity_sold: totalSold,
          ...restSkus,
        });
        break;
      }
      if (resultData.length === 0) {
        const skus = await this.getSkusByOptionValueNoneLoginIds(body);
        if (!skus || !skus.data || skus.data.length === 0) {
          throw new NotFoundException(
            'Không tìm thấy SKU nào với các ID option value đã cung cấp',
          );
        }
        resultData.push({
          ...skus.data[0],
          cart_item: [],
        });
      }
      return {
        status: 200,
        message: 'Lấy danh sách SKU theo mảng id của option value thành công',
        data: resultData,
      };
    } catch (e) {
      throw e;
    }
  }

  async getSkusByOptionValueNoneLoginIds(body: GetSkusByOptionValuesIdsDto) {
    try {
      const { optionValues } = body;
      const allIdsCombination =
        this.getAllOptionValueCombinations(optionValues);

      if (allIdsCombination.length === 0) {
        throw new BadRequestException(
          'Không có ID option value nào được cung cấp',
        );
      }
      const resultData = [];
      for (const ids of allIdsCombination) {
        const subquery = this.Skureposity.createQueryBuilder('sku')
          .innerJoin('sku.optionValue', 'optionValue')
          .where('optionValue.id IN (:...ids)', { ids })
          .groupBy('sku.id')
          .having('COUNT(DISTINCT optionValue.id) = :count', {
            count: ids.length,
          })
          .select('sku.id');
        const queryBuilder = this.Skureposity.createQueryBuilder('sku')
          .leftJoin('sku.detail_import', 'detail_import')
          .where(`sku.id IN (${subquery.getQuery()})`)
          .setParameters(subquery.getParameters())
          .select([
            'sku.id',
            'sku.masku',
            'sku.barcode',
            'sku.name',
            'sku.price_sold',
            'sku.price_compare',
            'sku.image',
            'sku.status',
            'detail_import.quantity_remaining',
            'detail_import.quantity_sold',
          ]);

        const skus = await queryBuilder.getOne();
        if (!skus) {
          continue;
        }
        const detailImports = skus?.detail_import || [];
        const totalRemaining =
          detailImports.reduce(
            (total, detail) => total + detail.quantity_remaining,
            0,
          ) || 0;
        const totalSold =
          detailImports.reduce(
            (total, detail) => total + detail.quantity_sold,
            0,
          ) || 0;

        const { detail_import, ...restSkus } = skus;
        resultData.push({
          quantity_remaining: totalRemaining,
          quantity_sold: totalSold,
          ...restSkus,
        });
        break;
      }
      if (resultData.length === 0) {
        throw new NotFoundException(
          'Không tìm thấy SKU nào với các ID option value đã cung cấp',
        );
      }
      return {
        status: 200,
        message: 'Lấy danh sách SKU theo mảng id của option value thành công',
        data: resultData,
      };
    } catch (e) {
      throw e;
    }
  }
}
