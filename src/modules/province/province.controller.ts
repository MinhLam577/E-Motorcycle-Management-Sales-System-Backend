import { Controller, Get, ParseIntPipe, Query, UsePipes } from '@nestjs/common';
import { ProvinceService } from './province.service';
import { Public } from 'src/decorators/public-route';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OptionalValidationPipe } from 'src/pipe/optional-validation.pipe';
import { AddressAPI } from 'src/constants/address.enum';
import { Tag } from 'src/constants/api-tag.enum';

@Public()
@ApiTags(Tag.PROVINCE)
@Controller('province')
export class ProvinceController {
  constructor(private readonly provinceService: ProvinceService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all provinces',
  })

  @UsePipes(OptionalValidationPipe)
  async getAllProvinces() {
    return await this.provinceService.getAllProvinces();
  }
}
