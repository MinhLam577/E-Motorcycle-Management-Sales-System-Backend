import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { DistrictService } from './district.service';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Tag } from 'src/constants/api-tag.enum';
import { Public } from 'src/decorators/public-route';
import { PositiveIntPipe } from 'src/pipe/positive-integer.pipe';

@Controller('district')
@ApiTags(Tag.DISTRICT)
@Public()
export class DistrictController {
  constructor(private districtService: DistrictService) {}

  @Get(':provinceCode')
  @ApiOperation({
    summary: 'Get district by province code',
    description: `Get all district by filters \n
        provinceCode: code of province
    `,
  })
  async getDistrictByProvinceCode(
    @Param('provinceCode', PositiveIntPipe) provinceCode: number,
  ) {
    return await this.districtService.getDistrictByProvinceCode(provinceCode);
  }
}
