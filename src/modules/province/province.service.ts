import { Injectable, NotFoundException } from '@nestjs/common';
import { AddressAPI } from 'src/constants/address.enum';
import { ResponseProvince } from './dto/province.response';

@Injectable()
export class ProvinceService {
  async getAllProvinces() {
    try {
      const response = await fetch(AddressAPI.PROVINCE_API, {
        method: 'GET',
      });

      const data: ResponseProvince[] = await response.json();
      const provinces =
        data?.map((p) => ({
          name: p.name,
          code: p.code,
        })) || [];
      return provinces;
    } catch (e) {
      throw e;
    }
  }
}
